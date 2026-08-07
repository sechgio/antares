"""Regresión M1: el pool de lectura tiene lock propio y no se serializa con
escrituras ni con otras lecturas (WAL aprovechado).

Antes, _db_lock (RLock global) protegía TODAS las operaciones de BD: cada
SELECT esperaba a escritores y a otros SELECTs, anulando la concurrencia de
lectores que WAL permite. Ahora las lecturas usan _db_read_lock y la conexión
de solo lectura dedicada; las escrituras siguen con _db_lock.
"""

import sqlite3
import threading

from backend.core import database as db
from backend.core.config_fields import save_fields
from backend.core.repository import _db_lock, close_connection


def _setup(db_path, config_path) -> None:
    """Catálogo mínimo con una fila sembrada."""
    save_fields([{"name": "codigo", "type": "TEXT", "required": True}])
    db.init_db()
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("INSERT INTO imagenes (codigo) VALUES ('A1')")
        conn.commit()
    finally:
        conn.close()


class TestReadPool:
    def test_pool_lectura_es_conexion_distinta(self, tmp_path, monkeypatch) -> None:
        """El pool de lectura debe ser un handle separado del de escritura."""
        db_file = tmp_path / "test.db"
        monkeypatch.setattr(db, "get_db_path", lambda: db_file)
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: tmp_path / "fields_config.json",
        )
        _setup(db_file, tmp_path / "fields_config.json")

        try:
            read_conn = db._get_read_connection()
            write_conn = db._get_connection()
            assert read_conn is not write_conn
        finally:
            close_connection()

    def test_lecturas_y_escrituras_concurrentes_no_fallan(self, tmp_path, monkeypatch) -> None:
        """Smoke de concurrencia: lectores paralelos mientras otro thread
        escribe no deben fallar ni devolver datos inconsistentes."""
        db_file = tmp_path / "test.db"
        monkeypatch.setattr(db, "get_db_path", lambda: db_file)
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: tmp_path / "fields_config.json",
        )
        _setup(db_file, tmp_path / "fields_config.json")

        errors: list[Exception] = []
        reads_done = threading.Event()

        def reader() -> None:
            try:
                for _ in range(60):
                    result = db.buscar_lote_por_codigos(["A1"])
                    if "A1" not in result:
                        errors.append(RuntimeError("lectura no encontró A1"))
            except Exception as exc:
                errors.append(exc)
            finally:
                reads_done.set()

        threads = [threading.Thread(target=reader) for _ in range(2)]
        for t in threads:
            t.start()

        # Writer: inserta desde una conexión aparte (WAL permite escritor
        # concurrente con lectores del pool ro).
        writer_conn = sqlite3.connect(str(db_file))
        try:
            for i in range(60):
                with _db_lock:
                    writer_conn.execute("INSERT INTO imagenes (codigo) VALUES (?)", (f"W{i}",))
                    writer_conn.commit()
        finally:
            writer_conn.close()

        for t in threads:
            t.join(timeout=10)

        try:
            assert not errors, f"errores de lectura: {errors}"
            assert reads_done.is_set()
            rows = db.obtener_todos()
            assert len(rows) == 61  # A1 + 60 W*
        finally:
            close_connection()

    def test_read_conn_funciona_si_el_archivo_no_existe_aun(self, tmp_path, monkeypatch) -> None:
        """get_read_connection no debe romper cuando el archivo de BD todavía
        no existe: crea el archivo y devuelve el handle de lectura."""
        db_file = tmp_path / "futuro.db"
        monkeypatch.setattr(db, "get_db_path", lambda: db_file)
        monkeypatch.setattr(
            "backend.core.config_fields._config_file",
            lambda: tmp_path / "fields_config.json",
        )

        from backend.core.repository import get_read_connection

        try:
            conn = get_read_connection(db_file)
            assert db_file.exists()
            # Un SELECT sobre tabla inexistente falla, pero la conexión sirve.
            conn.execute("SELECT 1").fetchone()
        finally:
            close_connection()
