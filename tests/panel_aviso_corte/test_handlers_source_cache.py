from __future__ import annotations

import base64
from io import BytesIO

import openpyxl
import pytest

from backend.handlers import panel_aviso_corte as handler_module


def _xlsx_b64(rows: list[list[object]]) -> str:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    buffer = BytesIO()
    workbook.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _parse(rows: list[list[object]]) -> dict[str, object]:
    return handler_module.panel_aviso_corte_parse_excel({"xlsx_b64": _xlsx_b64(rows), "filename": "lista.xlsx"})


_ROWS: list[list[object]] = [
    ["ID", "Dirección", "Cuadrante Afectado", "Fecha de Corte", "Motivo"],
    ["101", "Calle 1", "C-1", "3/5/2024", "Mantenimiento"],
    ["102", "Calle 2", "C-1", "3/5/2024", "Mantenimiento"],
    ["103", "", "C-2", "4/5/2024", "Reparación"],
]


def _match_params(**extra: object) -> dict[str, object]:
    return {
        "key_column": "ID",
        "strategy": "prefix",
        "address_column": "Dirección",
        "image_names": ["101_a.jpg", "101_b.jpg", "103.jpg", "999.jpg"],
        "export_mode": "include_empty",
        **extra,
    }


@pytest.fixture(autouse=True)
def _empty_cache() -> None:
    handler_module._source_cache.clear()


def test_parse_excel_devuelve_source_id() -> None:
    parsed = _parse(_ROWS)
    assert isinstance(parsed["sourceId"], str)
    assert parsed["sourceId"]


def test_compute_match_con_source_id_equivale_a_enviar_rows() -> None:
    parsed = _parse(_ROWS)
    by_rows = handler_module.panel_aviso_corte_compute_match(_match_params(rows=parsed["rows"]))
    by_id = handler_module.panel_aviso_corte_compute_match(_match_params(source_id=parsed["sourceId"]))
    assert by_id == by_rows
    assert by_id["summary"]["matched_images"] == 3


def test_compute_match_source_id_desconocido_sin_rows_pide_reenviar() -> None:
    assert handler_module.panel_aviso_corte_compute_match(_match_params(source_id="no-existe")) == {
        "sourceMissing": True,
    }


def test_compute_match_source_id_desconocido_con_rows_usa_rows() -> None:
    parsed = _parse(_ROWS)
    handler_module._source_cache.clear()
    result = handler_module.panel_aviso_corte_compute_match(
        _match_params(source_id=parsed["sourceId"], rows=parsed["rows"]),
    )
    assert result["summary"]["matched_images"] == 3


def test_cache_descarta_la_fuente_mas_antigua() -> None:
    first = _parse(_ROWS)["sourceId"]
    second = _parse(_ROWS)["sourceId"]
    third = _parse(_ROWS)["sourceId"]
    assert list(handler_module._source_cache) == [second, third]
    assert handler_module.panel_aviso_corte_compute_match(_match_params(source_id=first)) == {"sourceMissing": True}
