from backend.core.informes_v2.models import (
    R2_CANASTILLA_DIAMETERS,
    R2_VALVULA_DIAMETERS,
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


def test_create_empty_report_defaults_to_clasica_with_reservorios2_block() -> None:
    report = create_empty_report(4)
    assert report["plantilla"] == "clasica"
    assert report["header"]["contratista"] == ""
    assert report["header"]["cod_infraestructura"] == ""
    assert report["reservorios2"]["inspeccion"]["loza_techo_interior"] == {
        "normal": False,
        "critico": False,
        "observaciones": "",
        "sugerencias": "",
    }
    assert report["reservorios2"]["valvulas"]["desague"]["diametros"] == {
        d: 0 for d in R2_VALVULA_DIAMETERS
    }
    assert report["reservorios2"]["canastilla"]["desague"]["diametros"]["14"] == 0
    assert report["reservorios2"]["medidas"] == {
        "diametro": "",
        "diametro_interno": "",
        "altura_util": "",
        "altura_total": "",
        "etiqueta_diametro": "DIAMETRO",
        "etiqueta_diametro_interno": "DIAMETRO INTERNO",
        "etiqueta_altura_util": "ALTURA UTIL",
        "etiqueta_altura_total": "ALTURA TOTAL",
    }
    assert report["reservorios2"]["valvulas_totales"] == {"oper": None, "no_op": None}
    assert report["reservorios2"]["canastilla_totales"] == {"oper": None, "no_op": None}


def test_normalize_resolv_plantilla_desconocida_a_clasica() -> None:
    assert InformeV2.normalize({"plantilla": "inexistente"})["plantilla"] == "clasica"
    assert InformeV2.normalize({"plantilla": "reservorios2"})["plantilla"] == "reservorios2"
    assert InformeV2.normalize(None)["plantilla"] == "clasica"


def test_normalize_reservorios2_coerces_and_drops_unknown_keys() -> None:
    report = InformeV2.normalize(
        {
            "metadata": {"informe_id": 2},
            "plantilla": "reservorios2",
            "header": {"contratista": "SGIO SAC", "cod_infraestructura": "CI-2026-001"},
            "reservorios2": {
                "inspeccion": {"caja_registro": {"normal": True, "observaciones": "ok"}},
                "valvulas": {
                    "desague": {
                        "diametros": {"3": "2", "99": 5},
                        "oper": 1,
                        "sugerencias": "reemplazar",
                    }
                },
                "canastilla": {"succion": {"diametros": {"14": 3}}},
                "valvulas_totales": {"oper": "8", "no_op": 2},
                "canastilla_totales": {"oper": 5, "no_op": "1"},
                "medidas": {
                    "altura_util": "2.10",
                    "etiqueta_altura_util": "PROFUNDIDAD UTIL",
                    "inesperado": "x",
                },
            },
        }
    )
    assert report["header"]["contratista"] == "SGIO SAC"
    assert report["header"]["cod_infraestructura"] == "CI-2026-001"
    inspeccion = report["reservorios2"]["inspeccion"]["caja_registro"]
    assert inspeccion["normal"] is True
    assert inspeccion["critico"] is False
    assert inspeccion["sugerencias"] == ""
    valvulas = report["reservorios2"]["valvulas"]
    assert valvulas["desague"]["diametros"]["3"] == 2
    assert "99" not in valvulas["desague"]["diametros"]
    assert valvulas["desague"]["sugerencias"] == "reemplazar"
    assert set(valvulas["conduccion"]["diametros"]) == set(R2_VALVULA_DIAMETERS)
    assert report["reservorios2"]["canastilla"]["succion"]["diametros"]["14"] == 3
    assert report["reservorios2"]["valvulas_totales"] == {"oper": 8, "no_op": 2}
    assert report["reservorios2"]["canastilla_totales"] == {"oper": 5, "no_op": 1}
    assert report["reservorios2"]["medidas"]["altura_util"] == "2.10"
    assert report["reservorios2"]["medidas"]["etiqueta_altura_util"] == "PROFUNDIDAD UTIL"
    assert "inesperado" not in report["reservorios2"]["medidas"]


def test_normalize_reservorios2_no_toca_el_bloque_clasico() -> None:
    report = create_empty_report(1)
    report["valvulas"]["conduccion"]["diametros"]["4"] = 2
    report["medidas"]["tirante_limpieza"] = "0.20"
    normalized = InformeV2.normalize(report)
    assert normalized["valvulas"]["conduccion"]["diametros"]["4"] == 2
    assert normalized["medidas"]["tirante_limpieza"] == "0.20"
    assert normalized["plantilla"] == "clasica"
    assert normalized["reservorios2"]["valvulas"] == create_empty_report(1)["reservorios2"]["valvulas"]


def test_sum_diameter_columns_uses_diameters_de_reservorios2() -> None:
    block = create_empty_report(1)["reservorios2"]
    block["valvulas"]["conduccion"]["diametros"]["3"] = 2
    block["valvulas"]["desague"]["diametros"]["3"] = 1
    block["canastilla"]["succion"]["diametros"]["14"] = 3
    totals = sum_diameter_columns(
        block["valvulas"], ["conduccion", "desague"], R2_VALVULA_DIAMETERS
    )
    assert totals["3"] == 3
    assert set(totals) == set(R2_VALVULA_DIAMETERS)
    can_totals = sum_diameter_columns(
        block["canastilla"], ["succion"], R2_CANASTILLA_DIAMETERS
    )
    assert can_totals["14"] == 3
