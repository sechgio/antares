"""Tests para el módulo de base de datos SQLite.

Usa monkeypatch para redirigir la BD a un archivo temporal,
garantizando aislamiento entre tests.
"""

import pytest

from backend.core import database as db
from backend.core.config_fields import load_fields, save_fields


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    """Fixture que redirige la BD a un archivo temporal y limpia entre tests."""
    db_file = tmp_path / "test_catalogo.db"
    monkeypatch.setattr(db, "get_db_path", lambda: db_file)
    return db_file


class TestInitDb:
    def test_crea_tabla_si_no_existe(self, db_path, monkeypatch, tmp_path) -> None:
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

    def test_migra_datos_cuando_cambia_esquema(self, db_path, monkeypatch, tmp_path) -> None:
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

        lote = db.buscar_lote_por_codigos(["1"])
        assert "1" in lote
        assert lote["1"]["codigo"] == "1"
        assert lote["1"]["nombre"] == "Test"

    def test_aborta_migracion_si_vaciaria_catalogo(self, db_path, monkeypatch, tmp_path) -> None:
        """Renaming all columns must not silently wipe existing rows."""
        from backend.core.exceptions import DatabaseError

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
        conn.execute("INSERT INTO imagenes (codigo, nombre) VALUES (?, ?)", ("KEEP", "Intact"))
        conn.commit()
        conn.close()

        save_fields([
            {"name": "archivo", "type": "TEXT", "required": True},
            {"name": "cliente", "type": "TEXT"},
        ])
        with pytest.raises(DatabaseError, match="vacía|vaciar|abortada|catálogo"):
            db.init_db()

        # Catalog intact under previous schema
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "nombre", "type": "TEXT"},
        ])
        rows = db.obtener_todos()
        assert rows == [{"codigo": "KEEP", "nombre": "Intact"}]


class TestBuscarLotePorCodigos:
    def test_encuentra_registro(self, db_path, monkeypatch, tmp_path) -> None:
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

        resultado = db.buscar_lote_por_codigos(["ABC"])
        assert "ABC" in resultado
        assert resultado["ABC"]["codigo"] == "ABC"
        assert resultado["ABC"]["nombre"] == "Producto"
        # Explicit projection: only configured field names (no extra/id columns)
        assert set(resultado["ABC"].keys()) == {"codigo", "nombre"}

    def test_busca_case_insensitive(self, db_path, monkeypatch, tmp_path) -> None:
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

        lote = db.buscar_lote_por_codigos(["abc"])
        assert "abc" in lote
        assert lote["abc"]["codigo"] == "ABC"

        por_col = db.buscar_por_columna(["abc"], "codigo")
        assert "abc" in por_col
        assert por_col["abc"]["nombre"] == "Producto"

    def test_no_encuentra_retorna_vacio(self, db_path, monkeypatch, tmp_path) -> None:
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
        ])
        db.init_db()

        assert db.buscar_lote_por_codigos(["NO_EXISTE"]) == {}

    def test_strip_en_busqueda(self, db_path, monkeypatch, tmp_path) -> None:
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

        resultado = db.buscar_lote_por_codigos(["  XYZ  "])
        assert "XYZ" in resultado
        assert resultado["XYZ"]["codigo"] == "XYZ"

    def test_busca_por_cualquier_campo_texto_si_codigo_no_coincide(self, db_path, monkeypatch, tmp_path) -> None:
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

        resultado = db.buscar_lote_por_codigos(["69466481"])

        assert "69466481" in resultado
        assert resultado["69466481"]["codigo"] == "1"
        assert resultado["69466481"]["nombre"] == "69466481"

    def test_buscar_por_columna_obsoleta_retorna_vacio(self, db_path, monkeypatch, tmp_path) -> None:
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([
            {"name": "archivo", "type": "TEXT", "required": True},
            {"name": "cliente", "type": "TEXT"},
        ])
        db.init_db()

        assert db.buscar_por_columna(["IMG-001"], "codigo") == {}

    def test_buscar_por_columna_duplicado_conserva_primero_y_avisa(
        self, db_path, monkeypatch, tmp_path, caplog,
    ) -> None:
        """Dos registros con el mismo código en la columna clave no deben
        silenciosamente dejar ganar al último: se conserva el primero y se
        emite un warning que evidencia la colisión."""
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
        conn.execute("INSERT INTO imagenes (codigo, nombre) VALUES (?, ?)", ("DUP", "primero"))
        conn.execute("INSERT INTO imagenes (codigo, nombre) VALUES (?, ?)", ("DUP", "segundo"))
        conn.commit()
        conn.close()

        import logging
        with caplog.at_level(logging.WARNING, logger="backend.core.database"):
            resultado = db.buscar_por_columna(["DUP"], "codigo")

        assert "DUP" in resultado
        assert resultado["DUP"]["nombre"] == "primero"
        assert any("DUP" in rec.message for rec in caplog.records)

    def test_buscar_lote_por_codigos_duplicado_conserva_primero_y_avisa(
        self, db_path, monkeypatch, tmp_path, caplog,
    ) -> None:
        """Mismo contrato que buscar_por_columna: ante un código que coincide
        con dos registros distintos, gana el primero de forma determinista y
        se registra un warning (no hay 'last wins' silencioso)."""
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
        conn.execute("INSERT INTO imagenes (codigo, nombre) VALUES (?, ?)", ("DUP", "primero"))
        conn.execute("INSERT INTO imagenes (codigo, nombre) VALUES (?, ?)", ("DUP", "segundo"))
        conn.commit()
        conn.close()

        import logging
        with caplog.at_level(logging.WARNING, logger="backend.core.database"):
            resultado = db.buscar_lote_por_codigos(["DUP"])

        assert resultado["DUP"]["nombre"] == "primero"
        assert any("DUP" in rec.message for rec in caplog.records)

    def test_buscar_lote_por_codigos_mismo_registro_varios_campos_no_es_colision(
        self, db_path, monkeypatch, tmp_path, caplog,
    ) -> None:
        """Un mismo registro cuyo código aparece en varios campos no debe
        tratarse como colisión: el código mapea a ese único registro sin warning."""
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "alias", "type": "TEXT"},
        ])
        db.init_db()

        import sqlite3
        conn = sqlite3.connect(str(db_path))
        conn.execute("INSERT INTO imagenes (codigo, alias) VALUES (?, ?)", ("X1", "X1"))
        conn.commit()
        conn.close()

        import logging
        with caplog.at_level(logging.WARNING, logger="backend.core.database"):
            resultado = db.buscar_lote_por_codigos(["X1"])

        assert resultado["X1"]["codigo"] == "X1"
        assert not caplog.records


class TestImportarExcel:
    def test_importa_columnas_nuevas_del_excel_al_esquema(self, db_path, monkeypatch, tmp_path) -> None:
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

        assert imported == {"inserted": 1, "skipped": 0}
        assert rows == [{
            "codigo": "1",
            "marca": "Marca X",
            "nombre": "69466481",
            "modelo": "Modelo 2024",
        }]

    def test_importacion_reporta_skipped_en_filas_invalidas(self, db_path, monkeypatch, tmp_path) -> None:
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "nombre", "type": "TEXT"},
        ])

        pandas = pytest.importorskip("pandas")
        excel_path = tmp_path / "mixed.xlsx"
        pandas.DataFrame([
            {"codigo": "OK1", "nombre": "Valido"},
            {"codigo": "", "nombre": "Sin codigo"},
            {"codigo": None, "nombre": "Nulo"},
            {"codigo": "OK2", "nombre": "Otro"},
        ]).to_excel(excel_path, index=False)

        # Seed prior catalog that must be wiped on import
        db.init_db()
        import sqlite3
        conn = sqlite3.connect(str(db_path))
        conn.execute("INSERT INTO imagenes (codigo, nombre) VALUES (?, ?)", ("OLD", "viejo"))
        conn.commit()
        conn.close()

        result = db.importar_excel(str(excel_path))
        assert result == {"inserted": 2, "skipped": 2}
        rows = db.obtener_todos()
        assert len(rows) == 2
        assert {r["codigo"] for r in rows} == {"OK1", "OK2"}
        assert all(r["codigo"] != "OLD" for r in rows)

    def test_importacion_sincroniza_esquema_con_columnas_del_excel(self, db_path, monkeypatch, tmp_path) -> None:
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([
            {"name": "codigo", "type": "TEXT", "required": True},
            {"name": "nombre", "type": "TEXT"},
            {"name": "columna_obsoleta", "type": "TEXT"},
        ])

        pandas = pytest.importorskip("pandas")
        excel_path = tmp_path / "nueva_base.xlsx"
        pandas.DataFrame([
            {"archivo": "IMG-001.jpg", "cliente": "Cliente Norte"},
        ]).to_excel(excel_path, index=False)

        imported = db.importar_excel(str(excel_path))

        assert imported == {"inserted": 1, "skipped": 0}
        assert [f["name"] for f in load_fields()] == ["archivo", "cliente"]
        assert db.obtener_todos() == [{"archivo": "IMG-001.jpg", "cliente": "Cliente Norte"}]


class TestObtenerTodos:
    def test_retorna_lista_vacia(self, db_path, monkeypatch, tmp_path) -> None:
        config_path = tmp_path / "fields_config.json"
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: config_path,
        )
        save_fields([{"name": "codigo", "type": "TEXT"}])
        db.init_db()
        assert db.obtener_todos() == []
