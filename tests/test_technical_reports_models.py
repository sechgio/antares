from backend.core.technical_reports.models import TechnicalReport, create_empty_report


def test_empty_report_has_nested_defaults() -> None:
    report = create_empty_report(1)

    assert report["id"] == "RPT-0001"
    assert report["header"]["sgio"] == ""
    assert report["metadata"]["informe_id"] == 1
    assert report["inspeccion"]["caja_registro"] == "unchecked"
    assert report["valvulas"]["impulsion"]["2"] == 0
    assert report["canastillas"]["aduccion"]["14"] == 0


def test_normalize_report_patches_legacy_canastillas() -> None:
    report = TechnicalReport.normalize({
        "id": "RPT-0007",
        "metadata": {"informe_id": 7},
        "header": {"tipo": "ELEVADO"},
        "inspeccion": None,
        "valvulas": {},
        "canastillas": {"aduccion": {"2": 1}},
    })

    assert report["inspeccion"]["marco_tapa"] == "unchecked"
    assert report["canastillas"]["aduccion"]["14"] == 0
    assert report["header"]["volumen"] == 0
