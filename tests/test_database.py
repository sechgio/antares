"""Tests para el módulo de base de datos SQLite.

Usa monkeypatch para redirigir la BD a un archivo temporal,
garantizando aislamiento entre tests.
"""

import pytest

from backend.core import database as db
from backend.core.config_fields import save_fields


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    """Fixture que redirige la BD a un archivo temporal y limpia entre tests."""
    db_file = tmp_path / "test_catalogo.db"
    monkeypatch.setattr(db, "get_db_path", lambda: db_file)
    return db_file


class TestInitDb:
    def test_crea_tabla_si_no_existe(self, db_path, monkeypatch, tmp_path):
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: tmp_path / "fields_config.json",
        )
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True, "unique": True},
            {"name": "nombre", "type": "TEXT"},
        ])
        db.init_db()
        assert db_path.exists()

    def test_migra_datos_cuando_cambia_esquema(self, db_path, monkeypatch, tmp_path):
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )

        # Primer esquema
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "nombre", "type": "TEXT"},
        ])
        db.init_db()
        # Insertar dato directo
        import sqlite3
        conn = sqlite3.connect(str(db_path))
        conn.execute("INSERT INTO imagenes (codigo, nombre) VALUES (?, ?)", ("1", "Test"))
        conn.commit()
        conn.close()

        # Cambiar esquema (agregar campo)
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "nombre", "type": "TEXT"},
            {"name": "marca", "type": "TEXT"},
        ])
        db.init_db()

        registro = db.buscar_por_codigo("1")
        assert registro is not None
        assert registro["codigo"] == "1"
        assert registro["nombre"] == "Test"


class TestBuscarPorCodigo:
    def test_encuentra_registro(self, db_path, monkeypatch, tmp_path):
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "nombre", "type": "TEXT"},
        ])
        db.init_db()

        import sqlite3
        conn = sqlite3.connect(str(db_path))
        conn.execute("INSERT INTO imagenes (codigo, nombre) VALUES (?, ?)", ("ABC", "Producto"))
        conn.commit()
        conn.close()

        resultado = db.buscar_por_codigo("ABC")
        assert resultado is not None
        assert resultado["codigo"] == "ABC"
        assert resultado["nombre"] == "Producto"

    def test_no_encuentra_retorna_none(self, db_path, monkeypatch, tmp_path):
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
        ])
        db.init_db()

        assert db.buscar_por_codigo("NO_EXISTE") is None

    def test_strip_en_busqueda(self, db_path, monkeypatch, tmp_path):
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
        ])
        db.init_db()

        import sqlite3
        conn = sqlite3.connect(str(db_path))
        conn.execute("INSERT INTO imagenes (codigo) VALUES (?)", ("XYZ",))
        conn.commit()
        conn.close()

        # La búsqueda hace strip del código de entrada
        resultado = db.buscar_por_codigo("  XYZ  ")
        assert resultado is not None
        assert resultado["codigo"] == "XYZ"

    def test_busca_por_cualquier_campo_texto_si_codigo_no_coincide(self, db_path, monkeypatch, tmp_path):
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "nombre", "type": "TEXT"},
            {"name": "modelo", "type": "TEXT"},
        ])
        db.init_db()

        import sqlite3
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            "INSERT INTO imagenes (codigo, nombre, modelo) VALUES (?, ?, ?)",
            ("1", "69466481", "Modelo 2024"),
        )
        conn.commit()
        conn.close()

        resultado = db.buscar_por_codigo("69466481")

        assert resultado is not None
        assert resultado["codigo"] == "1"
        assert resultado["nombre"] == "69466481"


class TestImportarExcel:
    def test_importa_columnas_nuevas_del_excel_al_esquema(self, db_path, monkeypatch, tmp_path):
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "marca", "type": "TEXT"},
        ])

        pandas = pytest.importorskip("pandas")
        excel_path = tmp_path / "gio.xlsx"
        pandas.DataFrame([
            {"codigo": "1", "nombre": "69466481", "marca": "Marca X", "modelo": "Modelo 2024"},
        ]).to_excel(excel_path, index=False)

        imported = db.importar_excel(str(excel_path))
        rows = db.obtener_todos()

        assert imported == 1
        assert rows == [{
            "codigo": "1",
            "marca": "Marca X",
            "nombre": "69466481",
            "modelo": "Modelo 2024",
        }]


class TestObtenerTodos:
    def test_retorna_lista_vacia(self, db_path, monkeypatch, tmp_path):
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([{"name": "codigo", "type": "TEXT"}])
        db.init_db()
        assert db.obtener_todos() == []
