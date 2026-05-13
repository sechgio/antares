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
