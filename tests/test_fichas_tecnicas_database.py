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
