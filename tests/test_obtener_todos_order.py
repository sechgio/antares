"""Regresión M2: obtener_todos devuelve un orden determinista (por id).

El modo ``use_column_rename`` empareja archivo i ↔ registro i por posición
(preview y chunks del job usan obtener_todos con limit/offset). Sin ORDER BY,
el orden de filas era un detalle del plan de consulta de SQLite; con ORDER BY
id, preview y job siempre ven la misma secuencia.
"""

import sqlite3

from backend.core import database as db
from backend.core.config_fields import save_fields


def _setup(db_path, config_path) -> None:
    save_fields([{"name": "codigo", "type": "TEXT", "required": True}])
    db.init_db()
    conn = sqlite3.connect(str(db_path))
    try:
        # Inserciones deliberadamente desordenadas alfabéticamente.
        for codigo in ("ZETA", "ALFA", "MIKE", "BRAVO"):
            conn.execute("INSERT INTO imagenes (codigo) VALUES (?)", (codigo,))
        conn.commit()
    finally:
        conn.close()


class TestObtenerTodosOrder:
    def test_orden_por_id_de_insercion(self, tmp_path, monkeypatch) -> None:
        db_file = tmp_path / "test.db"
        monkeypatch.setattr(db, "get_db_path", lambda: db_file)
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: tmp_path / "fields_config.json",
        )
        _setup(db_file, tmp_path / "fields_config.json")

        rows = db.obtener_todos()
        assert [r["codigo"] for r in rows] == ["ZETA", "ALFA", "MIKE", "BRAVO"]

    def test_orden_consistente_con_offset_paginado(self, tmp_path, monkeypatch) -> None:
        db_file = tmp_path / "test.db"
        monkeypatch.setattr(db, "get_db_path", lambda: db_file)
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: tmp_path / "fields_config.json",
        )
        _setup(db_file, tmp_path / "fields_config.json")

        # La secuencia por chunks (offset 0,2 y 2,2) debe ser la misma que la
        # secuencia completa — el contrato del mapeo posicional por chunks.
        full = [r["codigo"] for r in db.obtener_todos()]
        chunked = [
            r["codigo"] for r in db.obtener_todos(limit=2, offset=0)
        ] + [
            r["codigo"] for r in db.obtener_todos(limit=2, offset=2)
        ]
        assert chunked == full
        assert full == ["ZETA", "ALFA", "MIKE", "BRAVO"]
