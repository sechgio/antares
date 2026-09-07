import pytest

from backend.core.exceptions import DatabaseError
from backend.core.fichas_tecnicas.database import FichasTecnicasDB


def test_corrupt_json_is_preserved_and_backed_up(tmp_path) -> None:
    path = tmp_path / "fichas_tecnicas.json"
    original = '{"broken": '
    path.write_text(original, encoding="utf-8")

    with pytest.raises(DatabaseError, match="corrupto"):
        FichasTecnicasDB(path)

    assert path.read_text(encoding="utf-8") == original
    backups = list(tmp_path.glob("fichas_tecnicas.json.corrupt.*.bak"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == original


def test_get_renormalizes_stale_satisfaccion(tmp_path) -> None:
    db = FichasTecnicasDB(tmp_path / "fichas.json")
    created = db.create({"cliente": "Acme"})
    db._items[created["id"]]["satisfaccion"] = "no-existe"
    got = db.get(created["id"])
    assert got is not None
    assert got["satisfaccion"] == ""


def test_ficha_crud_preserves_generated_ids_and_replace_count(tmp_path) -> None:
    db = FichasTecnicasDB(tmp_path / "fichas_tecnicas.json")

    first = db.create()
    duplicate = db.create(dict(first))

    assert first["id"] == "FT-00001"
    assert duplicate["id"] == "FT-00002"
    assert duplicate["last_modified"]

    imported, deleted_count = db.replace_all_counted([{"id": "FT-00010", "cliente": "Importado"}])

    assert deleted_count == 2
    assert imported[0]["id"] == "FT-00010"
    assert db.get("FT-00010")["cliente"] == "Importado"
