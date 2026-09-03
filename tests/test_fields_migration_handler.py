
import sqlite3
import threading

import pytest

from backend.core import database as db
from backend.core.config_fields import load_fields, save_fields
from backend.core.exceptions import DatabaseError
from backend.handlers.database import db_fields_reset, db_fields_update


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    db_file = tmp_path / "test_catalogo.db"
    monkeypatch.setattr(db, "get_db_path", lambda: db_file)
    return db_file


@pytest.fixture
def config_path(tmp_path, monkeypatch):
    cfg = tmp_path / "fields_config.json"
    monkeypatch.setattr("backend.core.config_fields._config_file", lambda: cfg)
    return cfg


def _insert(db_path: object, columns: tuple[str, ...], values: tuple[object, ...]) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            f"INSERT INTO imagenes ({', '.join(columns)}) VALUES ({', '.join('?' * len(values))})",
            values,
        )
        conn.commit()
    finally:
        conn.close()


class TestDbFieldsUpdateMigrationSafety:
    def test_esquema_sin_solape_no_persiste_config(self, db_path, config_path) -> None:
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "nombre", "type": "TEXT"},
        ])
        db.init_db()
        _insert(db_path, ("codigo", "nombre"), ("KEEP", "Intact"))

        with pytest.raises(DatabaseError, match=r"abortada|vacía|catálogo"):
            db_fields_update({"fields": [
                {"name": "archivo", "type": "TEXT", "required": True},
                {"name": "cliente", "type": "TEXT"},
            ]})

        assert load_fields() == [
            {"name": "codigo", "type": "TEXT", "required": True, "unique": False},
            {"name": "nombre", "type": "TEXT", "required": False, "unique": False},
        ]
        db.init_db()
        assert db.obtener_todos() == [{"codigo": "KEEP", "nombre": "Intact"}]

    def test_cambio_aditivo_persiste_y_migra(self, db_path, config_path) -> None:
        save_fields([{"name": "codigo", "type": "TEXT", "required": True}])
        db.init_db()
        _insert(db_path, ("codigo",), ("A1",))

        result = db_fields_update({"fields": [
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "marca", "type": "TEXT"},
        ]})

        assert [f["name"] for f in result["fields"]] == ["codigo", "marca"]
        assert load_fields()[1]["name"] == "marca"
        assert db.obtener_todos() == [{"codigo": "A1", "marca": ""}]

    def test_lectura_espera_mientras_se_publica_config_y_esquema(self, db_path, config_path, monkeypatch) -> None:
        save_fields([{"name": "codigo", "type": "TEXT", "required": True}])
        db.init_db()
        _insert(db_path, ("codigo",), ("A1",))

        migration_entered = threading.Event()
        release_migration = threading.Event()
        original_init = db._init_db

        def blocked_init(*args, **kwargs):
            migration_entered.set()
            assert release_migration.wait(timeout=5)
            return original_init(*args, **kwargs)

        monkeypatch.setattr(db, "_init_db", blocked_init)
        migration_errors: list[Exception] = []

        def migrate() -> None:
            try:
                db_fields_update({"fields": [
                    {"name": "codigo", "type": "TEXT", "required": True},
                    {"name": "marca", "type": "TEXT"},
                ]})
            except Exception as exc:
                migration_errors.append(exc)

        migration_thread = threading.Thread(target=migrate)
        migration_thread.start()
        assert migration_entered.wait(timeout=5)

        read_started = threading.Event()
        read_finished = threading.Event()
        read_result: list[list[dict[str, object]]] = []
        read_errors: list[Exception] = []

        def read() -> None:
            read_started.set()
            try:
                read_result.append(db.obtener_todos())
            except Exception as exc:
                read_errors.append(exc)
            finally:
                read_finished.set()

        reader_thread = threading.Thread(target=read)
        reader_thread.start()
        assert read_started.wait(timeout=5)
        assert not read_finished.wait(timeout=0.2)

        release_migration.set()
        migration_thread.join(timeout=5)
        reader_thread.join(timeout=5)

        assert migration_errors == []
        assert read_errors == []
        assert read_result == [[{"codigo": "A1", "marca": ""}]]

    def test_cambio_con_solape_preserva_datos(self, db_path, config_path) -> None:
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "nombre", "type": "TEXT"},
        ])
        db.init_db()
        _insert(db_path, ("codigo", "nombre"), ("K1", "Antiguo"))

        db_fields_update({"fields": [
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "nombre", "type": "TEXT"},
            {"name": "extra", "type": "TEXT"},
        ]})
        db.init_db()
        assert db.obtener_todos() == [{"codigo": "K1", "nombre": "Antiguo", "extra": ""}]

    def test_reset_a_defaults_sin_solape_no_persiste(self, db_path, config_path) -> None:
        save_fields([
            {"name": "nis", "type": "TEXT", "required": True},
            {"name": "sgio", "type": "TEXT"},
        ])
        db.init_db()
        _insert(db_path, ("nis", "sgio"), ("N1", "S1"))

        with pytest.raises(DatabaseError, match=r"abortada|vacía|catálogo"):
            db_fields_reset({})

        assert [f["name"] for f in load_fields()] == ["nis", "sgio"]
        db.init_db()
        assert db.obtener_todos() == [{"nis": "N1", "sgio": "S1"}]

    def test_reset_con_catalogo_vacio_si_funciona(self, db_path, config_path) -> None:
        save_fields([
            {"name": "nis", "type": "TEXT", "required": True},
            {"name": "sgio", "type": "TEXT"},
        ])
        db.init_db()

        result = db_fields_reset({})

        names = [f["name"] for f in result["fields"]]
        assert names == [f["name"] for f in db.load_fields()]

    def test_campos_invalidos_se_sanean_sin_efectos(self, db_path, config_path) -> None:
        save_fields([{"name": "codigo", "type": "TEXT", "required": True}])
        db.init_db()

        result = db_fields_update({"fields": [
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "select", "type": "TEXT"},
            {"name": "DROP TABLE", "type": "TEXT"},
        ]})

        assert [f["name"] for f in result["fields"]] == ["codigo"]
