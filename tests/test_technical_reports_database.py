import pytest

from backend.core.exceptions import DatabaseError
from backend.core.technical_reports.database import TechnicalReportsDB
from backend.core.technical_reports.models import create_empty_report


def test_crud_roundtrip_uses_json_file(tmp_path) -> None:
    db = TechnicalReportsDB(tmp_path / "technical_reports.json")
    report = create_empty_report(1)

    created = db.create(report)
    created["header"]["cs"] = "SUR"
    updated = db.update("RPT-0001", created)

    reloaded = TechnicalReportsDB(tmp_path / "technical_reports.json")
    assert updated["header"]["cs"] == "SUR"
    assert reloaded.get("RPT-0001")["header"]["cs"] == "SUR"
    assert reloaded.delete("RPT-0001") is True
    assert reloaded.get_all() == []


def test_corrupt_json_is_preserved_and_backed_up(tmp_path) -> None:
    path = tmp_path / "technical_reports.json"
    original = '{"broken": '
    path.write_text(original, encoding="utf-8")

    with pytest.raises(DatabaseError, match="corrupto"):
        TechnicalReportsDB(path)

    assert path.read_text(encoding="utf-8") == original
    backups = list(tmp_path.glob("technical_reports.json.corrupt.*.bak"))
    assert len(backups) == 1
    assert backups[0].read_text(encoding="utf-8") == original
