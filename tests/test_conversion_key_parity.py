
from __future__ import annotations

from unittest.mock import MagicMock

from backend.handlers import conversion


def test_preview_empty_key_uses_lote_not_auto_column(monkeypatch) -> None:
    lote_calls: list[list[str]] = []
    columna_calls: list[tuple] = []

    monkeypatch.setattr(
        "backend.core.database.buscar_lote_por_codigos",
        lambda codes: lote_calls.append(list(codes)) or {},
    )
    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, col: columna_calls.append((list(codes), col)) or {},
    )
    monkeypatch.setattr(
        "backend.core.config_fields.get_field_names",
        lambda: ["codigo", "nis"],
    )
    monkeypatch.setattr(
        conversion,
        "_preview_detect_fields",
        lambda files, cols: ({"detected_key_column": "nis"}, {"nis": 10, "codigo": 1}),
    )
    monkeypatch.setattr(
        conversion,
        "_resolve_key_column",
        lambda *a, **k: "nis",
    )

    engine_preview = MagicMock(return_value=[("C:/a/1.jpg", "1.jpg", False)])
    monkeypatch.setattr(
        conversion.RenamerEngine,
        "preview_lote",
        engine_preview,
    )

    result = conversion.preview(
        {
            "files": ["C:/a/1.jpg"],
            "patron": "{codigo}_{seq}{ext}",
            "secuencia": 1,
            "key_column": "",
            "usar_rename": True,
        }
    )

    assert "preview" in result
    assert lote_calls, "expected buscar_lote_por_codigos for empty key_column"
    assert not columna_calls, "empty key_column must not auto-detect via buscar_por_columna"


def test_preview_explicit_key_column_still_uses_column(monkeypatch) -> None:
    columna_calls: list[str] = []

    monkeypatch.setattr("backend.core.database.buscar_lote_por_codigos", lambda codes: {})
    monkeypatch.setattr(
        "backend.core.database.buscar_por_columna",
        lambda codes, col: columna_calls.append(col) or {},
    )
    monkeypatch.setattr("backend.core.config_fields.get_field_names", lambda: ["codigo", "nis"])
    monkeypatch.setattr(
        conversion,
        "_preview_detect_fields",
        lambda files, cols: ({}, {"codigo": 0, "nis": 0}),
    )
    monkeypatch.setattr(conversion, "_resolve_key_column", lambda key, *a, **k: key or "codigo")

    conversion.preview(
        {
            "files": ["C:/a/1.jpg"],
            "patron": "{codigo}_{seq}{ext}",
            "secuencia": 1,
            "key_column": "codigo",
        }
    )
    assert columna_calls == ["codigo"]
