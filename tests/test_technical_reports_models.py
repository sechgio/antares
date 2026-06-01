from backend.core.technical_reports.models import (
    DEFAULT_MEDIDA_LABEL_DIAMETRO,
    DEFAULT_MEDIDA_LABEL_DIAMETRO_INTERNO,
    TechnicalReport,
    create_empty_report,
)


def test_empty_report_has_nested_defaults() -> None:
    report = create_empty_report(1)

    assert report["id"] == "RPT-0001"
    assert report["header"]["sgio"] == ""
    assert report["metadata"]["informe_id"] == 1
    assert report["inspeccion"]["caja_registro"] == "unchecked"
    assert report["valvulas"]["impulsion"]["2"] == 0
    assert report["canastillas"]["aduccion"]["14"] == 0
    assert report["medidas"]["etiqueta_diametro"] == DEFAULT_MEDIDA_LABEL_DIAMETRO
    assert report["medidas"]["etiqueta_diametro_interno"] == DEFAULT_MEDIDA_LABEL_DIAMETRO_INTERNO


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
    assert report["medidas"]["etiqueta_diametro"] == DEFAULT_MEDIDA_LABEL_DIAMETRO


def test_normalize_report_preserves_custom_medida_labels() -> None:
    report = TechnicalReport.normalize({
        "metadata": {"informe_id": 8},
        "medidas": {
            "etiqueta_diametro": "LARGO",
            "etiqueta_diametro_interno": "ANCHO",
            "diametro": "12",
            "diametro_interno": "8",
        },
    })

    assert report["medidas"]["etiqueta_diametro"] == "LARGO"
    assert report["medidas"]["etiqueta_diametro_interno"] == "ANCHO"
    assert report["medidas"]["diametro"] == "12"
