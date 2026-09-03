
import sqlite3

from backend.core import database as db
from backend.core.config_fields import save_fields


def _setup(db_path, config_path) -> None:
    save_fields([{"name": "codigo", "type": "TEXT", "required": True}])
    db.init_db()
    conn = sqlite3.connect(str(db_path))
    try:
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

        full = [r["codigo"] for r in db.obtener_todos()]
        chunked = [
            r["codigo"] for r in db.obtener_todos(limit=2, offset=0)
        ] + [
            r["codigo"] for r in db.obtener_todos(limit=2, offset=2)
        ]
        assert chunked == full
        assert full == ["ZETA", "ALFA", "MIKE", "BRAVO"]
