from __future__ import annotations

import pytest

import backend.handlers.database as h


def test_db_import_mapea_stats(monkeypatch) -> None:
    monkeypatch.setattr(h, "importar_excel", lambda _p: {"inserted": 7, "skipped": 2})
    assert h.db_import({"path": "x.xlsx"}) == {"imported": 7, "inserted": 7, "skipped": 2}


def test_db_import_sin_path_falla_validacion() -> None:
    with pytest.raises(ValueError):
        h.db_import({})


def test_db_export_devuelve_exported(monkeypatch) -> None:
    monkeypatch.setattr(h, "exportar_excel", lambda _p: 11)
    assert h.db_export({"path": "out.xlsx"}) == {"exported": 11}


def test_db_clear_devuelve_cleared(monkeypatch) -> None:
    monkeypatch.setattr(h, "limpiar_base_datos", lambda: 4)
    assert h.db_clear({}) == {"cleared": 4}


def test_db_template_completa_extension_y_devuelve_path(monkeypatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(h, "generar_plantilla_excel", lambda p: calls.append(p))
    assert h.db_template({"path": "salida"}) == {"path": "salida.xlsx"}
    assert calls == ["salida.xlsx"]

    h.db_template({"path": "ya.xlsx"})
    assert calls[-1] == "ya.xlsx"


def test_db_fields_devuelve_campos(monkeypatch) -> None:
    monkeypatch.setattr(h, "load_fields", lambda: [{"name": "a"}])
    assert h.db_fields({}) == {"fields": [{"name": "a"}]}


def test_db_fields_update_rollback_cuando_init_db_falla(monkeypatch) -> None:
    monkeypatch.setattr("backend.core.config_fields.sanitize_field_defs", lambda f: f)
    monkeypatch.setattr("backend.core.database.validate_fields_migration", lambda _f: None)
    monkeypatch.setattr("backend.core.config_fields.load_fields", lambda: [{"name": "old"}])

    saved: list[list[dict]] = []
    monkeypatch.setattr("backend.core.config_fields.save_fields", lambda f: saved.append(f))

    def _boom() -> None:
        raise RuntimeError("init falló")

    monkeypatch.setattr("backend.core.database.init_db", _boom)
    with pytest.raises(RuntimeError, match="init falló"):
        h.db_fields_update({"fields": [{"name": "new"}]})
    # el rollback restaura los campos anteriores tras guardar los nuevos
    assert saved == [[{"name": "new"}], [{"name": "old"}]]


def test_db_fields_reset_rollback_cuando_init_db_falla(monkeypatch) -> None:
    monkeypatch.setattr("backend.core.database.validate_fields_migration", lambda _f: None)
    monkeypatch.setattr("backend.core.config_fields.load_fields", lambda: [{"name": "old"}])
    monkeypatch.setattr("backend.core.config_fields.reset_to_defaults", lambda: [{"name": "def"}])
    saved: list[list[dict]] = []
    monkeypatch.setattr("backend.core.config_fields.save_fields", lambda f: saved.append(f))

    def _boom() -> None:
        raise RuntimeError("init falló")

    monkeypatch.setattr("backend.core.database.init_db", _boom)
    with pytest.raises(RuntimeError):
        h.db_fields_reset({})
    assert saved == [[{"name": "old"}]]


def test_db_validate_mapping_rechaza_no_dict() -> None:
    with pytest.raises(ValueError, match="diccionario"):
        h.db_validate_mapping({"mapping": [1, 2]})


def test_db_columns_devuelve_campos_y_registros(monkeypatch) -> None:
    monkeypatch.setattr(h, "get_field_names", lambda: ["a", "b"])
    monkeypatch.setattr("backend.core.database.obtener_todos", lambda limit=100: [{"a": 1}])
    out = h.db_columns({})
    assert out == {"columns": ["a", "b"], "records": [{"a": 1}], "total": 1}


def test_rename_patterns_handlers(monkeypatch) -> None:
    monkeypatch.setattr(h, "load_patterns", lambda: [{"p": 1}])
    monkeypatch.setattr(h, "save_patterns", lambda p: p)
    monkeypatch.setattr(h, "reset_patterns_defaults", lambda: [{"d": 1}])
    assert h.rename_patterns_get({}) == {"patterns": [{"p": 1}]}
    assert h.rename_patterns_update({"patterns": [{"x": 2}]}) == {"patterns": [{"x": 2}]}
    assert h.rename_patterns_reset({}) == {"patterns": [{"d": 1}]}
