from backend.core.informes_v2.database import InformesV2DB
from backend.core.informes_v2.models import create_empty_report as create_informe
from backend.core.technical_reports.database import TechnicalReportsDB
from backend.core.technical_reports.models import create_empty_report as create_technical


def test_informes_create_and_update_results_are_detached(tmp_path) -> None:
    db = InformesV2DB(tmp_path / "informes.json")

    created = db.create(create_informe(1))
    created["header"]["estacion"] = "MUTATED"
    assert db.get("IV2-0001")["header"]["estacion"] == ""

    updated = db.update("IV2-0001", db.get("IV2-0001"))
    updated["header"]["estacion"] = "MUTATED AGAIN"
    assert db.get("IV2-0001")["header"]["estacion"] == ""


def test_informes_replace_all_result_is_detached(tmp_path) -> None:
    db = InformesV2DB(tmp_path / "informes.json")

    replaced = db.replace_all([create_informe(1)])
    replaced[0]["header"]["estacion"] = "MUTATED"

    assert db.get("IV2-0001")["header"]["estacion"] == ""


def test_technical_create_and_update_results_are_detached(tmp_path) -> None:
    db = TechnicalReportsDB(tmp_path / "technical.json")

    created = db.create(create_technical(1))
    created["header"]["cs"] = "MUTATED"
    assert db.get("RPT-0001")["header"]["cs"] == ""

    updated = db.update("RPT-0001", db.get("RPT-0001"))
    updated["header"]["cs"] = "MUTATED AGAIN"
    assert db.get("RPT-0001")["header"]["cs"] == ""


def test_technical_replace_all_result_is_detached(tmp_path) -> None:
    db = TechnicalReportsDB(tmp_path / "technical.json")

    replaced = db.replace_all([create_technical(1)])
    replaced[0]["header"]["cs"] = "MUTATED"

    assert db.get("RPT-0001")["header"]["cs"] == ""
