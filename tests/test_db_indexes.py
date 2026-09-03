
from __future__ import annotations

from backend.core.config_fields import get_field_names
from backend.core.database import get_db_path, init_db


def test_indexes_created() -> None:
    init_db()

    import sqlite3

    with sqlite3.connect(str(get_db_path())) as conn:
        cursor = conn.execute("PRAGMA index_list(imagenes)")
        indexes = cursor.fetchall()

        explicit_indexes = [idx for idx in indexes if not idx[1].startswith("sqlite_autoindex")]
        assert len(explicit_indexes) > 0, "No explicit indexes found on imagenes table"

        index_names = {idx[1] for idx in explicit_indexes}
        for field_name in get_field_names():
            if field_name.lower() == "id":
                continue
            assert f"idx_imagenes_{field_name}" in index_names
            assert f"idx_imagenes_lower_{field_name}" in index_names

        for idx in explicit_indexes:
            idx_name = idx[1]
            info = conn.execute(f"PRAGMA index_info({idx_name})").fetchall()
            assert len(info) > 0, f"Index {idx_name} has no columns"
