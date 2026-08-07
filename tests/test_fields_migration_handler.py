"""Regresión H1: los cambios de campos (db_fields_update / db_fields_reset) no
deben persistir una config que la migración rechazaría.

El bug original: el handler guardaba la config nueva en disco y recién después
llamaba init_db(); si la migración abortaba (esquema nuevo sin columna
compartida + catálogo con filas), la config quedaba adelantada respecto al
esquema real de la tabla y el siguiente arranque del backend moría en init_db
(sys.exit(1)) — la app quedaba inservible hasta editar el config a mano.
"""

import sqlite3

import pytest

from backend.core import database as db
from backend.core.config_fields import load_fields, save_fields
from backend.core.exceptions import DatabaseError
from backend.handlers.database import db_fields_reset, db_fields_update


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    """BD en archivo temporal + conexión del pool apuntando a él."""
    db_file = tmp_path / "test_catalogo.db"
    monkeypatch.setattr(db, "get_db_path", lambda: db_file)
    return db_file


@pytest.fixture
def config_path(tmp_path, monkeypatch):
    """Config de campos en archivo temporal (aislado del user_data real)."""
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
        """H1: renombrar todas las columnas con catálogo poblado debe fallar
        SIN persistir la config nueva y SIN tocar los datos."""
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

        # La config en disco sigue siendo la antigua...
        assert load_fields() == [
            {"name": "codigo", "type": "TEXT", "required": True, "unique": False},
            {"name": "nombre", "type": "TEXT", "required": False, "unique": False},
        ]
        # ...y un "reinicio" (init_db al arrancar) funciona con datos intactos.
        db.init_db()
        assert db.obtener_todos() == [{"codigo": "KEEP", "nombre": "Intact"}]

    def test_cambio_aditivo_persiste_y_migra(self, db_path, config_path) -> None:
        """Agregar columnas sigue funcionando (camino feliz intacto)."""
        save_fields([{"name": "codigo", "type": "TEXT", "required": True}])
        db.init_db()
        _insert(db_path, ("codigo",), ("A1",))

        result = db_fields_update({"fields": [
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "marca", "type": "TEXT"},
        ]})

        assert [f["name"] for f in result["fields"]] == ["codigo", "marca"]
        assert load_fields()[1]["name"] == "marca"
        # ALTER TABLE ADD COLUMN ... DEFAULT '' → las filas existentes leen ''.
        assert db.obtener_todos() == [{"codigo": "A1", "marca": ""}]

    def test_cambio_con_solape_preserva_datos(self, db_path, config_path) -> None:
        """Esquema nuevo que conserva al menos una columna sigue migrando y
        preservando los datos (comportamiento previo intacto)."""
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
        """H1 para db_fields_reset: catálogo con columnas custom + filas → el
        reset a defaults (sin solape) debe fallar sin persistir."""
        save_fields([
            {"name": "nis", "type": "TEXT", "required": True},
            {"name": "sgio", "type": "TEXT"},
        ])
        db.init_db()
        _insert(db_path, ("nis", "sgio"), ("N1", "S1"))

        with pytest.raises(DatabaseError, match=r"abortada|vacía|catálogo"):
            db_fields_reset({})

        assert [f["name"] for f in load_fields()] == ["nis", "sgio"]
        db.init_db()  # arranque sano
        assert db.obtener_todos() == [{"nis": "N1", "sgio": "S1"}]

    def test_reset_con_catalogo_vacio_si_funciona(self, db_path, config_path) -> None:
        """Reset a defaults con tabla vacía (nada que perder) sí procede."""
        save_fields([
            {"name": "nis", "type": "TEXT", "required": True},
            {"name": "sgio", "type": "TEXT"},
        ])
        db.init_db()

        result = db_fields_reset({})

        names = [f["name"] for f in result["fields"]]
        assert names == [f["name"] for f in db.load_fields()]

    def test_campos_invalidos_se_sanean_sin_efectos(self, db_path, config_path) -> None:
        """Definiciones inválidas (keyword SQLite, nombre inseguro) se dropean
        como antes y el resto del cambio procede."""
        save_fields([{"name": "codigo", "type": "TEXT", "required": True}])
        db.init_db()

        result = db_fields_update({"fields": [
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "select", "type": "TEXT"},  # keyword SQLite → dropeado
            {"name": "DROP TABLE", "type": "TEXT"},  # nombre inseguro → dropeado
        ]})

        assert [f["name"] for f in result["fields"]] == ["codigo"]
