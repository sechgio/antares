from backend.core.informes_v2.models import (
    InformeV2,
    create_empty_report,
    sum_diameter_columns,
    sum_oper_no_op,
)


def test_create_empty_report_defaults() -> None:
    report = create_empty_report(3)
    assert report["id"] == "IV2-0003"
    assert report["header"]["tipo"] == "ELEVADO"
    assert report["valvulas"]["conduccion"]["diametros"]["16"] == 0
    assert report["linea"]["impulsion_rebombeo"]["oper"] == 0
    assert report["medidas"]["tirante_limpieza"] == ""


def test_normalize_keeps_empty_photo_id() -> None:
    report = InformeV2.normalize(
        {
            "metadata": {"informe_id": 1},
            "header": {"estacion": "R-900", "suministro": "2748175"},
        }
    )
    assert report["header"]["photo_id"] == ""


def test_normalize_preserves_explicit_photo_id() -> None:
    report = InformeV2.normalize(
        {
            "metadata": {"informe_id": 1},
            "header": {"photo_id": "IMG-01", "estacion": "R-900"},
        }
    )
    assert report["header"]["photo_id"] == "IMG-01"


def test_sum_diameter_and_oper() -> None:
    report = create_empty_report(1)
    report["valvulas"]["conduccion"]["diametros"]["2"] = 1
    report["valvulas"]["purga"]["diametros"]["2"] = 2
    report["valvulas"]["conduccion"]["oper"] = 1
    report["valvulas"]["purga"]["no_op"] = 1
    totals = sum_diameter_columns(report["valvulas"], ["conduccion", "impulsion", "aduccion", "bypass", "purga"])
    oper, no_op = sum_oper_no_op(report["valvulas"], ["conduccion", "impulsion", "aduccion", "bypass", "purga"])
    assert totals["2"] == 3
    assert oper == 1
    assert no_op == 1
