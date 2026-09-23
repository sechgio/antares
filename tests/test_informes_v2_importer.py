from io import BytesIO

from openpyxl import Workbook

from backend.core.informes_v2.importer import (
    R2_TEMPLATE_HEADERS,
    TEMPLATE_HEADERS,
    import_reports_from_bytes,
    normalize_header_value,
)
from backend.core.informes_v2.template_xlsx import build_template_xlsx_bytes


def test_normalize_header_strips_noise() -> None:
    assert normalize_header_value("Fecha de Ejecución") == "fechaejecucion"
    assert normalize_header_value("Valv Cond 2\"") == "valvcond2"


def test_csv_import_maps_headers_and_valves() -> None:
    content = (
        b"ID;Informe;Estacion;Tipo;Volumen;Distrito;Suministro;SGIO;Valv Cond 2;Valv Cond Oper;Lin Aduccion 4;Largo;Observacion\n"
        b"R-900;1;R 900 Elevado;ELEVADO;900;Villa El Salvador;2748175;SG-1;2;1;3;4.5;Sin obs\n"
    )
    reports = import_reports_from_bytes("datos.csv", content)
    report = reports[0]
    assert report["id"] == "IV2-0001"
    assert report["header"]["photo_id"] == "R-900"
    assert report["header"]["estacion"] == "R 900 Elevado"
    assert report["header"]["volumen"] == 900
    assert report["valvulas"]["conduccion"]["diametros"]["2"] == 2
    assert report["valvulas"]["conduccion"]["oper"] == 1
    assert report["linea"]["aduccion"]["diametros"]["4"] == 3
    assert report["medidas"]["largo"] == "4.5"
    assert report["medidas"]["observacion"] == "Sin obs"


def test_xlsx_import_assigns_ids_when_missing() -> None:
    wb = Workbook()
    ws = wb.active
    ws.append(["Estacion", "Tipo", "Suministro"])
    ws.append(["Est A", "CISTERNA", "111"])
    ws.append(["Est B", "ELEVADO", "222"])
    buf = BytesIO()
    wb.save(buf)

    reports = import_reports_from_bytes("datos.xlsx", buf.getvalue())
    assert [r["id"] for r in reports] == ["IV2-0001", "IV2-0002"]
    assert reports[0]["header"]["photo_id"] == "Est A"
    assert reports[1]["header"]["tipo"] == "ELEVADO"


def test_template_xlsx_has_canonical_headers() -> None:
    content = build_template_xlsx_bytes()
    from openpyxl import load_workbook

    loaded = load_workbook(BytesIO(content))
    headers = [cell.value for cell in next(loaded.active.iter_rows(min_row=1, max_row=1))]
    assert headers == TEMPLATE_HEADERS
    assert "ID" in headers
    assert "Valv Cond 2" in headers
    assert "Lin Impulsion 16" in headers
    assert "Tirante Limpieza" in headers


def test_reservorios2_template_xlsx_has_only_its_fields() -> None:
    from openpyxl import load_workbook

    content = build_template_xlsx_bytes("reservorios2")
    loaded = load_workbook(BytesIO(content))
    headers = [cell.value for cell in next(loaded.active.iter_rows(min_row=1, max_row=1))]

    assert headers == R2_TEMPLATE_HEADERS
    assert "informe_id" in headers
    assert "caja_registro" in headers
    assert "obs_caja_registro" in headers
    assert "valvulas_desague_3" in headers
    assert "valvulas_desague_oper" in headers
    assert "canastillas_succion_14" in headers
    assert "medidas_altura_total" in headers
    assert "medidas_etiqueta_altura_total" in headers
    assert not {"cs", "contratista", "sgio"} & set(headers)
    assert not {"ID", "Estacion", "Insp CAJA DE REGISTRO Normal", "R2 Valv Desague 3"} & set(headers)


def test_all_template_headers_are_mapped() -> None:
    from backend.core.informes_v2.importer import COLUMN_MAPPING

    unmapped = [
        header
        for header in TEMPLATE_HEADERS
        if normalize_header_value(header) not in COLUMN_MAPPING
    ]
    assert unmapped == [], f"Headers de plantilla sin mapeo: {unmapped}"


def test_all_reservorios2_template_headers_are_mapped() -> None:
    from backend.core.informes_v2.importer import COLUMN_MAPPING

    unmapped = [
        header
        for header in R2_TEMPLATE_HEADERS
        if normalize_header_value(header) not in COLUMN_MAPPING
    ]
    assert unmapped == [], f"Headers de plantilla Nueva sin mapeo: {unmapped}"


def test_template_xlsx_roundtrip_maps_all_sections() -> None:
    from openpyxl import load_workbook

    content = build_template_xlsx_bytes()
    wb = load_workbook(BytesIO(content))
    ws = wb.active
    headers = [cell.value for cell in next(ws.iter_rows(min_row=1, max_row=1))]
    by_header = {h: i + 1 for i, h in enumerate(headers)}

    row_values = {
        "ID": "7098",
        "Informe": 3,
        "Estacion": "R 900 Elevado",
        "Tipo": "ELEVADO",
        "Volumen": 900,
        "Ubicacion": "Av. Principal 123",
        "Distrito": "Villa El Salvador",
        "Fecha Ejecucion": "2026-03-15",
        "Suministro": "2748175",
        "SGIO": "SG-9",
        "Valv Cond 2": 2,
        "Valv Cond Oper": 1,
        "Valv Cond No Op": 0,
        "Valv Cond Obs": "OK cond",
        "Valv Imp 4": 1,
        "Lin Aduccion 6": 3,
        "Lin Impulsion 8": 4,
        "Lin Impulsion Oper": 2,
        "Lin Impulsion Obs": "rebombeo ok",
        "Lin Rebose 10": 1,
        "Largo": "5.5",
        "Ancho": "3.2",
        "Diametro": "2.1",
        "Altura Rebose": "1.0",
        "Altura Total": "4.0",
        "Tirante Limpieza": "0.3",
        "Observacion": "Sin hallazgos",
    }
    for header, value in row_values.items():
        ws.cell(row=2, column=by_header[header], value=value)

    buf = BytesIO()
    wb.save(buf)
    reports = import_reports_from_bytes("plantilla.xlsx", buf.getvalue())
    assert len(reports) == 1
    report = reports[0]

    assert report["id"] == "IV2-0003"
    assert report["header"]["photo_id"] == "7098"
    assert report["header"]["estacion"] == "R 900 Elevado"
    assert report["header"]["tipo"] == "ELEVADO"
    assert report["header"]["volumen"] == 900
    assert report["header"]["ubicacion"] == "Av. Principal 123"
    assert report["header"]["distrito"] == "Villa El Salvador"
    assert report["header"]["fecha_ejecucion"] == "15/03/2026"
    assert report["header"]["suministro"] == "2748175"
    assert report["header"]["sgio"] == "SG-9"

    assert report["valvulas"]["conduccion"]["diametros"]["2"] == 2
    assert report["valvulas"]["conduccion"]["oper"] == 1
    assert report["valvulas"]["conduccion"]["observaciones"] == "OK cond"
    assert report["valvulas"]["impulsion"]["diametros"]["4"] == 1

    assert report["linea"]["aduccion"]["diametros"]["6"] == 3
    assert report["linea"]["impulsion_rebombeo"]["diametros"]["8"] == 4
    assert report["linea"]["impulsion_rebombeo"]["oper"] == 2
    assert report["linea"]["impulsion_rebombeo"]["observaciones"] == "rebombeo ok"
    assert report["linea"]["rebose"]["diametros"]["10"] == 1

    assert report["medidas"]["largo"] == "5.5"
    assert report["medidas"]["ancho"] == "3.2"
    assert report["medidas"]["diametro"] == "2.1"
    assert report["medidas"]["altura_rebose"] == "1.0"
    assert report["medidas"]["altura_total"] == "4.0"
    assert report["medidas"]["tirante_limpieza"] == "0.3"
    assert report["medidas"]["observacion"] == "Sin hallazgos"


def test_alias_impulsion_pelado_corresponde_a_la_valvula() -> None:
    content = (
        b"ID;Impulsion 8;Impulsion Oper;Impulsion No Op;Obs Impulsion;Lin Impulsion 8;Lin Impulsion Obs\n"
        b"R-1;5;1;0;valv ok;9;lin ok\n"
    )

    report = import_reports_from_bytes("datos.csv", content)[0]

    assert report["valvulas"]["impulsion"]["diametros"]["8"] == 5
    assert report["valvulas"]["impulsion"]["oper"] == 1
    assert report["valvulas"]["impulsion"]["no_op"] == 0
    assert report["valvulas"]["impulsion"]["observaciones"] == "valv ok"
    assert report["linea"]["impulsion_rebombeo"]["diametros"]["8"] == 9
    assert report["linea"]["impulsion_rebombeo"]["observaciones"] == "lin ok"


def test_reservorios2_xlsx_roundtrip_maps_all_sections() -> None:
    content = build_template_xlsx_bytes("reservorios2")
    from openpyxl import load_workbook

    wb = load_workbook(BytesIO(content))
    ws = wb.active
    by_header = {header: index + 1 for index, header in enumerate(R2_TEMPLATE_HEADERS)}
    row_values = {
        "informe_id": 9,
        "photo_id": "R2-900",
        "dia": 15,
        "mes": "MARZO",
        "anio": 2026,
        "codigo_infraestructura": "R-900",
        "ubicacion": "A.H. VILLA",
        "suministro": "2748175",
        "tipo": "ELEVADO",
        "volumen": 900,
        "caja_registro": "normal",
        "obs_caja_registro": "sin fisuras",
        "cerco_perimetrico": "critico",
        "sug_cerco": "reparar",
        "valvulas_desague_3": 2,
        "valvulas_desague_oper": 1,
        "obs_valvulas_desague": "operativa",
        "sug_valvulas_desague": "mantener",
        "canastillas_succion_14": 3,
        "canastillas_succion_no_op": 1,
        "obs_canastillas_succion": "oxidada",
        "sug_canastillas_succion": "reemplazar",
        "medidas_diametro": "4.5",
        "medidas_diametro_interno": "4.2",
        "medidas_altura_util": "2.1",
        "medidas_altura_total": "2.5",
        "medidas_etiqueta_diametro": "LARGO",
        "medidas_etiqueta_diametro_interno": "ANCHO",
        "medidas_etiqueta_altura_util": "PROFUNDIDAD UTIL",
        "medidas_etiqueta_altura_total": "PROFUNDIDAD TOTAL",
    }
    for header, value in row_values.items():
        ws.cell(row=2, column=by_header[header], value=value)

    buffer = BytesIO()
    wb.save(buffer)
    report = import_reports_from_bytes(
        "plantilla_nueva.xlsx",
        buffer.getvalue(),
        "reservorios2",
    )[0]

    assert report["id"] == "IV2-0009"
    assert report["plantilla"] == "reservorios2"
    assert report["header"]["photo_id"] == "R2-900"
    assert report["header"]["estacion"] == "R-900"
    assert report["header"]["distrito"] == "A.H. VILLA"
    assert report["header"]["fecha_ejecucion"] == "15/03/2026"
    assert report["header"]["suministro"] == "2748175"
    assert report["reservorios2"]["inspeccion"]["caja_registro"] == {
        "normal": True,
        "critico": False,
        "observaciones": "sin fisuras",
        "sugerencias": "",
    }
    assert report["reservorios2"]["inspeccion"]["cerco"]["critico"] is True
    assert report["reservorios2"]["inspeccion"]["cerco"]["sugerencias"] == "reparar"
    assert report["reservorios2"]["valvulas"]["desague"] == {
        "diametros": {"2": 0, "3": 2, "4": 0, "6": 0, "8": 0, "10": 0, "12": 0},
        "oper": 1,
        "no_op": 0,
        "observaciones": "operativa",
        "sugerencias": "mantener",
    }
    assert report["reservorios2"]["canastilla"]["succion"]["diametros"]["14"] == 3
    assert report["reservorios2"]["canastilla"]["succion"]["no_op"] == 1
    assert report["reservorios2"]["canastilla"]["succion"]["sugerencias"] == "reemplazar"
    assert report["reservorios2"]["medidas"] == {
        "diametro": "4.5",
        "diametro_interno": "4.2",
        "altura_util": "2.1",
        "altura_total": "2.5",
        "etiqueta_diametro": "LARGO",
        "etiqueta_diametro_interno": "ANCHO",
        "etiqueta_altura_util": "PROFUNDIDAD UTIL",
        "etiqueta_altura_total": "PROFUNDIDAD TOTAL",
    }


def test_import_detects_reservorios2_from_columns() -> None:
    from openpyxl import load_workbook

    wb = load_workbook(BytesIO(build_template_xlsx_bytes("reservorios2")))
    wb.active.cell(row=2, column=1, value="R2-1")
    buf = BytesIO()
    wb.save(buf)

    # Las columnas R2 mandan aunque el switch de la UI diga "clasica".
    report = import_reports_from_bytes("plantilla_nueva.xlsx", buf.getvalue(), "clasica")[0]
    assert report["plantilla"] == "reservorios2"


def test_import_detects_clasica_from_columns() -> None:
    from openpyxl import load_workbook

    wb = load_workbook(BytesIO(build_template_xlsx_bytes("clasica")))
    wb.active.cell(row=2, column=1, value="C-1")
    buf = BytesIO()
    wb.save(buf)

    report = import_reports_from_bytes("plantilla.xlsx", buf.getvalue(), "reservorios2")[0]
    assert report["plantilla"] == "clasica"


def test_import_plantilla_column_and_param_fallback() -> None:
    # La columna Plantilla explícita gana al parámetro.
    content = b"ID;Estacion;Plantilla\nC-1;E 1;reservorios2\n"
    report = import_reports_from_bytes("datos.csv", content, "clasica")[0]
    assert report["plantilla"] == "reservorios2"

    # Sin señal en el archivo, el parámetro de la UI decide.
    content = b"ID;Estacion\nC-1;E 1\n"
    report = import_reports_from_bytes("datos.csv", content, "reservorios2")[0]
    assert report["plantilla"] == "reservorios2"


def test_import_reservorios2_partial_csv_keeps_valves_and_measures() -> None:
    content = (
        b"informe_id;photo_id;valvulas_desague_3;medidas_altura_total\n"
        b"9;R2-900;2;2.5\n"
    )

    report = import_reports_from_bytes("parcial.csv", content, "reservorios2")[0]

    assert report["plantilla"] == "reservorios2"
    assert report["reservorios2"]["valvulas"]["desague"]["diametros"]["3"] == 2
    assert report["reservorios2"]["medidas"]["altura_total"] == "2.5"


def test_import_reservorios2_aliases_keep_values_when_template_hint_is_present() -> None:
    content = b"informe_id;r2valvdesague3;inspcajaregistronormal\n9;2;1\n"

    report = import_reports_from_bytes("datos.csv", content, "reservorios2")[0]

    assert report["reservorios2"]["valvulas"]["desague"]["diametros"]["3"] == 2
    assert report["reservorios2"]["inspeccion"]["caja_registro"]["normal"] is True


def test_import_reservorios2_accepts_technical_report_aliases() -> None:
    content = (
        "ID;Código;Empresa;Recomendaciones Cerco;Canast Aduccion 14;Photo ID\n"
        "7;R-900;ACCIONA;reparar;3;F-900\n"
    ).encode()

    report = import_reports_from_bytes("tecnico.csv", content, "reservorios2")[0]

    assert report["id"] == "IV2-0007"
    assert report["header"]["photo_id"] == "F-900"
    assert report["header"]["estacion"] == "R-900"
    assert report["header"]["contratista"] == "ACCIONA"
    assert report["reservorios2"]["inspeccion"]["cerco"]["sugerencias"] == "reparar"
    assert report["reservorios2"]["canastilla"]["aduccion"]["diametros"]["14"] == 3


def test_import_global_oper_totals_do_not_fabricate_row_values() -> None:
    content = (
        b"informe_id;valvulas_operativas;valvulas_no_operativas;"
        b"canastillas_operativas;canastillas_no_operativas\n"
        b"3;8;2;5;1\n"
    )

    report = import_reports_from_bytes("tecnico.csv", content, "reservorios2")[0]
    r2 = report["reservorios2"]

    assert r2["valvulas_totales"] == {"oper": 8, "no_op": 2}
    assert r2["canastilla_totales"] == {"oper": 5, "no_op": 1}
    assert all(row["oper"] == 0 and row["no_op"] == 0 for row in r2["valvulas"].values())
    assert all(row["oper"] == 0 and row["no_op"] == 0 for row in r2["canastilla"].values())


def test_import_reservorios2_releases_classic_rows_before_reparsing(monkeypatch) -> None:
    from backend.core.informes_v2 import importer

    calls = 0
    classic_rows = []

    def parse_csv(_content, _mapping):
        nonlocal calls
        calls += 1
        if calls == 1:
            rows = [{"photo_id": "C-1"}]
            classic_rows.append(rows)
            return rows
        assert len(classic_rows[0]) == 0
        return [{"informe_id": "9", "r2_medidas_diametro": "2.5"}]

    monkeypatch.setattr(importer, "parse_csv_file", parse_csv)

    reports = import_reports_from_bytes("datos.csv", b"contenido", "reservorios2")

    assert len(reports) == 1
    assert calls == 2
